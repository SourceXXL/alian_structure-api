import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule } from "@nestjs/config";
import { SimulatorController } from "./simulator.controller";
import { SimulatorService } from "./simulator.service";
import { Simulation } from "./entities/simulation.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Simulation]), ConfigModule],
  controllers: [SimulatorController],
  providers: [SimulatorService],
  exports: [SimulatorService],
})
export class SimulatorModule {}
