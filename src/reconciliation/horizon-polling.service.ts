import { Injectable } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { ReconciliationService } from "./reconciliation.service";

@Injectable()
export class HorizonPollingService {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Interval(60_000)
  poll() {
    return this.reconciliationService.pollHorizon();
  }
}
