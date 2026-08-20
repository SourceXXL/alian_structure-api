import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { PortfolioOwnerGuard } from "./guards/portfolio-owner.guard";
import { PortfolioService } from "./services/portfolio.service";
import {
  CreatePortfolioDto,
  UpdatePortfolioDto,
  PortfolioResponseDto,
  PortfolioListResponseDto,
} from "./dto/portfolio.dto";
import { ApiErrorDto } from "./dto/api-error.dto";
import { PortfolioStatus } from "./entities/portfolio.entity";

@ApiTags("Portfolio")
@ApiBearerAuth("JWT-auth")
@Controller("portfolio")
@UseGuards(JwtAuthGuard)
export class PortfolioManagementController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Post()
  @ApiOperation({ summary: "Create portfolio" })
  @ApiResponse({
    status: 201,
    description: "Portfolio created",
    type: PortfolioResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Validation error / bad request",
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 500,
    description: "Unexpected error",
    type: ApiErrorDto,
  })
  @HttpCode(HttpStatus.CREATED)
  async createPortfolio(
    @Request() req: any,
    @Body() createPortfolioDto: CreatePortfolioDto,
  ): Promise<PortfolioResponseDto> {
    return this.portfolioService.createPortfolio(
      req.user.id,
      createPortfolioDto,
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get portfolio" })
  @UseGuards(PortfolioOwnerGuard)
  @ApiResponse({
    status: 200,
    description: "Portfolio found",
    type: PortfolioResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "Portfolio not found",
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 500,
    description: "Unexpected error",
    type: ApiErrorDto,
  })
  async getPortfolio(@Param("id") id: string): Promise<PortfolioResponseDto> {
    return this.portfolioService.getPortfolio(id) as any;
  }

  @Get()
  @ApiOperation({ summary: "List user portfolios" })
  @ApiResponse({
    status: 200,
    description: "Portfolios listed",
    type: PortfolioResponseDto,
    isArray: true,
  })
  @ApiResponse({
    status: 500,
    description: "Unexpected error",
    type: ApiErrorDto,
  })
  async listPortfolios(@Request() req: any): Promise<PortfolioListResponseDto> {
    const portfolios = await this.portfolioService.getUserPortfolios(
      req.user.id,
    );
    return { portfolios };
  }

  @Put(":id")
  @ApiOperation({ summary: "Update portfolio" })
  @UseGuards(PortfolioOwnerGuard)
  @ApiResponse({
    status: 200,
    description: "Portfolio updated",
    type: PortfolioResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Validation error / bad request",
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 404,
    description: "Portfolio not found",
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 500,
    description: "Unexpected error",
    type: ApiErrorDto,
  })
  async updatePortfolio(
    @Param("id") id: string,
    @Body() updatePortfolioDto: UpdatePortfolioDto,
  ): Promise<PortfolioResponseDto> {
    return this.portfolioService.updatePortfolio(id, updatePortfolioDto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Archive portfolio" })
  @UseGuards(PortfolioOwnerGuard)
  @ApiResponse({
    status: 200,
    description: "Portfolio archived",
    type: PortfolioResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: "Portfolio not found",
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 500,
    description: "Unexpected error",
    type: ApiErrorDto,
  })
  async archivePortfolio(
    @Param("id") id: string,
  ): Promise<PortfolioResponseDto> {
    return this.portfolioService.archivePortfolio(id, PortfolioStatus.ARCHIVED);
  }
}
