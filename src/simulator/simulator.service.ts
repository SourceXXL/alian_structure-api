import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { JsonRpcProvider, formatEther, formatUnits } from "ethers";
import {
  Simulation,
  SimulationStatus,
  SupportedChain,
} from "./entities/simulation.entity";
import { CreateSimulationDto, RunSimulationDto } from "./dto/simulation.dto";

interface AgentAction {
  blockNumber: number;
  txHash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: number;
  gasPrice: string;
  timestamp: number;
  /** Marks transactions replayed from historical data */
  replayed?: boolean;
}

interface GasReport {
  totalGasUsed: number;
  averageGasPerBlock: number;
  averageGasPerTx: number;
  totalEstimatedCostEth: string;
  breakdown: { blockNumber: number; gasUsed: number }[];
}

@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);

  private readonly rpcUrls: Record<SupportedChain, string> = {
    [SupportedChain.ETHEREUM]: "",
    [SupportedChain.POLYGON]: "",
    [SupportedChain.ARBITRUM]: "",
    [SupportedChain.OPTIMISM]: "",
  };

  constructor(
    @InjectRepository(Simulation)
    private readonly simulationRepo: Repository<Simulation>,
    private readonly configService: ConfigService,
  ) {
    this.rpcUrls[SupportedChain.ETHEREUM] =
      configService.get<string>("ETH_RPC_URL") || "https://eth.llamarpc.com";
    this.rpcUrls[SupportedChain.POLYGON] =
      configService.get<string>("POLYGON_RPC_URL") || "https://polygon.llamarpc.com";
    this.rpcUrls[SupportedChain.ARBITRUM] =
      configService.get<string>("ARBITRUM_RPC_URL") || "https://arbitrum.llamarpc.com";
    this.rpcUrls[SupportedChain.OPTIMISM] =
      configService.get<string>("OPTIMISM_RPC_URL") || "https://optimism.llamarpc.com";
  }

  async createSimulation(
    userId: string,
    dto: CreateSimulationDto,
  ): Promise<Simulation> {
    const provider = new JsonRpcProvider(this.rpcUrls[dto.chain]);
    let forkBlock = dto.forkBlockNumber;

    if (forkBlock === 0) {
      forkBlock = await provider.getBlockNumber();
    }

    const simulation = this.simulationRepo.create({
      userId,
      chain: dto.chain,
      forkBlockNumber: forkBlock,
      blocksToSimulate: dto.blocksToSimulate,
      timeScaleFactor: dto.timeScaleFactor ?? 1,
      status: SimulationStatus.PENDING,
      agentActions: [],
    });

    return this.simulationRepo.save(simulation);
  }

  async runSimulation(
    simulationId: string,
    userId: string,
    dto: RunSimulationDto,
  ): Promise<Simulation> {
    const simulation = await this.findOne(simulationId, userId);

    if (simulation.status === SimulationStatus.RUNNING) {
      throw new BadRequestException("Simulation is already running");
    }
    if (simulation.status === SimulationStatus.COMPLETED) {
      throw new BadRequestException("Simulation already completed");
    }

    await this.simulationRepo.update(simulation.id, {
      status: SimulationStatus.RUNNING,
      replayTxHashes: dto.replayTxHashes ?? [],
    });

    // Run asynchronously to avoid blocking the HTTP response
    this.executeSimulation(simulation, dto.agentAddresses ?? [], dto.replayTxHashes ?? []).catch(
      (err) => this.logger.error(`Simulation ${simulationId} failed: ${err.message}`),
    );

    return this.simulationRepo.findOneBy({ id: simulationId });
  }

  private async executeSimulation(
    simulation: Simulation,
    agentAddresses: string[],
    replayTxHashes: string[],
  ): Promise<void> {
    const startTime = Date.now();
    const provider = new JsonRpcProvider(this.rpcUrls[simulation.chain]);

    const actions: AgentAction[] = [];
    const gasBreakdown: { blockNumber: number; gasUsed: number }[] = [];
    let totalGasUsed = 0;

    try {
      const fromBlock = simulation.forkBlockNumber;
      const toBlock = fromBlock + simulation.blocksToSimulate - 1;

      // --- Transaction replay: fetch specific historical txs first ---
      if (replayTxHashes.length > 0) {
        const replayActions = await this.replayTransactions(provider, replayTxHashes);
        actions.push(...replayActions);
        replayActions.forEach((a) => (totalGasUsed += a.gasUsed));
      }

      // --- Process blocks in parallel batches of 10 for speed ---
      // Time-scale: higher timeScaleFactor → no artificial delay between batches
      const BATCH = 10;
      for (let b = fromBlock; b <= toBlock; b += BATCH) {
        const batchEnd = Math.min(b + BATCH - 1, toBlock);
        const blockNumbers = Array.from(
          { length: batchEnd - b + 1 },
          (_, i) => b + i,
        );

        const blocks = await Promise.all(
          blockNumbers.map((n) => provider.getBlock(n, true)),
        );

        for (const block of blocks) {
          if (!block) continue;

          let blockGas = 0;
          for (const tx of block.prefetchedTransactions) {
            const isRelevant =
              agentAddresses.length === 0 ||
              agentAddresses.includes(tx.from) ||
              agentAddresses.includes(tx.to ?? "");

            if (!isRelevant) continue;

            const receipt = await provider.getTransactionReceipt(tx.hash);
            const gasUsed = receipt ? Number(receipt.gasUsed) : 21000;
            blockGas += gasUsed;
            totalGasUsed += gasUsed;

            actions.push({
              blockNumber: block.number,
              txHash: tx.hash,
              from: tx.from,
              to: tx.to ?? "",
              value: formatEther(tx.value),
              gasUsed,
              gasPrice: formatUnits(tx.gasPrice ?? 0n, "gwei"),
              timestamp: block.timestamp,
            });
          }

          gasBreakdown.push({ blockNumber: block.number, gasUsed: blockGas });
        }

        await this.simulationRepo.update(simulation.id, {
          blocksProcessed: batchEnd - fromBlock + 1,
        });

        // Time-scale delay: skip delay when timeScaleFactor > 1
        // (factor of 1 = real-time pacing between batches is not enforced; we just record it)
      }

      const durationMs = Date.now() - startTime;
      const gasReport: GasReport = {
        totalGasUsed,
        averageGasPerBlock:
          gasBreakdown.length > 0 ? Math.round(totalGasUsed / gasBreakdown.length) : 0,
        averageGasPerTx:
          actions.filter((a) => !a.replayed).length > 0
            ? Math.round(totalGasUsed / actions.filter((a) => !a.replayed).length)
            : 0,
        totalEstimatedCostEth: formatEther(
          BigInt(totalGasUsed) * 20n * 1_000_000_000n,
        ),
        breakdown: gasBreakdown,
      };

      const comparisonReport = await this.buildComparisonReport(
        provider,
        simulation.forkBlockNumber,
        simulation.blocksToSimulate,
        actions,
      );

      await this.simulationRepo.update(simulation.id, {
        status: SimulationStatus.COMPLETED,
        agentActions: actions as unknown as Record<string, unknown>[],
        gasReport: gasReport as unknown as Record<string, unknown>,
        comparisonReport,
        durationMs,
        blocksProcessed: simulation.blocksToSimulate,
      });

      this.logger.log(`Simulation ${simulation.id} completed in ${durationMs}ms`);
    } catch (err) {
      await this.simulationRepo.update(simulation.id, {
        status: SimulationStatus.FAILED,
        errorMessage: err.message,
        durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  /**
   * Replay specific historical transactions by hash.
   * Fetches real on-chain tx + receipt and records them as replayed actions.
   */
  private async replayTransactions(
    provider: JsonRpcProvider,
    txHashes: string[],
  ): Promise<AgentAction[]> {
    const results = await Promise.allSettled(
      txHashes.map(async (hash) => {
        const [tx, receipt] = await Promise.all([
          provider.getTransaction(hash),
          provider.getTransactionReceipt(hash),
        ]);
        if (!tx || !receipt) return null;

        const block = await provider.getBlock(tx.blockNumber!);
        return {
          blockNumber: tx.blockNumber!,
          txHash: tx.hash,
          from: tx.from,
          to: tx.to ?? "",
          value: formatEther(tx.value),
          gasUsed: Number(receipt.gasUsed),
          gasPrice: formatUnits(tx.gasPrice ?? 0n, "gwei"),
          timestamp: block?.timestamp ?? 0,
          replayed: true,
        } as AgentAction;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<AgentAction> => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);
  }

  /**
   * Compare simulation outcome vs actual historical on-chain data.
   */
  private async buildComparisonReport(
    provider: JsonRpcProvider,
    fromBlock: number,
    count: number,
    simulatedActions: AgentAction[],
  ): Promise<Record<string, unknown>> {
    const toBlock = fromBlock + count - 1;

    const sampleBlocks = await Promise.all([
      provider.getBlock(fromBlock),
      provider.getBlock(Math.floor((fromBlock + toBlock) / 2)),
      provider.getBlock(toBlock),
    ]);

    const actualTxCounts = sampleBlocks
      .filter(Boolean)
      .map((b) => ({ blockNumber: b!.number, txCount: b!.transactions.length }));

    const replayedCount = simulatedActions.filter((a) => a.replayed).length;

    return {
      simulatedTxCount: simulatedActions.length - replayedCount,
      replayedTxCount: replayedCount,
      sampleActualBlocks: actualTxCounts,
      blockRange: { from: fromBlock, to: toBlock },
      note: "Full comparison requires historical transaction index",
    };
  }

  async findAll(userId: string): Promise<Simulation[]> {
    return this.simulationRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
  }

  async findOne(id: string, userId: string): Promise<Simulation> {
    const sim = await this.simulationRepo.findOne({ where: { id, userId } });
    if (!sim) throw new NotFoundException(`Simulation ${id} not found`);
    return sim;
  }

  async getReport(id: string, userId: string): Promise<Record<string, unknown>> {
    const sim = await this.findOne(id, userId);
    return {
      id: sim.id,
      chain: sim.chain,
      forkBlockNumber: sim.forkBlockNumber,
      blocksSimulated: sim.blocksToSimulate,
      blocksProcessed: sim.blocksProcessed,
      timeScaleFactor: sim.timeScaleFactor,
      status: sim.status,
      durationMs: sim.durationMs,
      gasReport: sim.gasReport,
      comparisonReport: sim.comparisonReport,
      agentActionCount: (sim.agentActions ?? []).length,
      replayedTxCount: (sim.replayTxHashes ?? []).length,
      createdAt: sim.createdAt,
      updatedAt: sim.updatedAt,
    };
  }

  /** Export full simulation data as a structured JSON report */
  async exportReport(id: string, userId: string): Promise<Record<string, unknown>> {
    const sim = await this.findOne(id, userId);
    return {
      exportedAt: new Date().toISOString(),
      simulation: {
        id: sim.id,
        chain: sim.chain,
        forkBlockNumber: sim.forkBlockNumber,
        blocksToSimulate: sim.blocksToSimulate,
        blocksProcessed: sim.blocksProcessed,
        timeScaleFactor: sim.timeScaleFactor,
        status: sim.status,
        durationMs: sim.durationMs,
        createdAt: sim.createdAt,
        updatedAt: sim.updatedAt,
      },
      gasReport: sim.gasReport,
      comparisonReport: sim.comparisonReport,
      agentActions: sim.agentActions ?? [],
      replayTxHashes: sim.replayTxHashes ?? [],
    };
  }

  async deleteSimulation(id: string, userId: string): Promise<void> {
    const sim = await this.findOne(id, userId);
    if (sim.status === SimulationStatus.RUNNING) {
      throw new BadRequestException("Cannot delete a running simulation");
    }
    await this.simulationRepo.delete(id);
  }
}
