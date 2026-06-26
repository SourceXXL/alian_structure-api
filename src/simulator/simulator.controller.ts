import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { SimulatorService } from "./simulator.service";
import { CreateSimulationDto, RunSimulationDto } from "./dto/simulation.dto";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";

@ApiTags("simulator")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("simulator")
export class SimulatorController {
  private readonly logger = new Logger(SimulatorController.name);

  constructor(private readonly simulatorService: SimulatorService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a simulation (fork from a block)" })
  @ApiResponse({ status: 201, description: "Simulation created" })
  create(@Request() req, @Body() dto: CreateSimulationDto) {
    return this.simulatorService.createSimulation(req.user.id, dto);
  }

  @Post(":id/run")
  @ApiOperation({ summary: "Run an existing simulation" })
  run(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RunSimulationDto,
  ) {
    return this.simulatorService.runSimulation(id, req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List all simulations for the current user" })
  findAll(@Request() req) {
    return this.simulatorService.findAll(req.user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a simulation by ID" })
  findOne(@Request() req, @Param("id", ParseUUIDPipe) id: string) {
    return this.simulatorService.findOne(id, req.user.id);
  }

  @Get(":id/report")
  @ApiOperation({ summary: "Get simulation report (gas, comparison, actions summary)" })
  getReport(@Request() req, @Param("id", ParseUUIDPipe) id: string) {
    return this.simulatorService.getReport(id, req.user.id);
  }

  @Get(":id/export")
  @ApiOperation({ summary: "Export full simulation data as JSON report" })
  @ApiResponse({ status: 200, description: "Full simulation JSON export" })
  exportReport(@Request() req, @Param("id", ParseUUIDPipe) id: string) {
    return this.simulatorService.exportReport(id, req.user.id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a simulation" })
  @ApiResponse({ status: 204, description: "Deleted" })
  remove(@Request() req, @Param("id", ParseUUIDPipe) id: string) {
    return this.simulatorService.deleteSimulation(id, req.user.id);
  }
}
