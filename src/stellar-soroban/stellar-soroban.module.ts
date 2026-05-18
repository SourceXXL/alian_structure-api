import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { StellarSorobanController } from "./stellar-soroban.controller";
import { StellarSorobanService } from "./stellar-soroban.service";

@Module({
  imports: [ConfigModule],
  controllers: [StellarSorobanController],
  providers: [StellarSorobanService],
  exports: [StellarSorobanService],
})
export class StellarSorobanModule {}
