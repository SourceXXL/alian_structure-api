import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { UserRole } from "src/core/user/entities/user.entity";

@Injectable()
export class ComplianceOfficerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const roles: string[] = request.user?.roles ?? [];
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("No authenticated user found");
    }

    // assuming that KYC operators are the compliance officers and admins will also have access
    if (user.role !== UserRole.ADMIN || user.role !== UserRole.KYC_OPERATOR) {
      throw new ForbiddenException(
        "Access to audit logs is restricted to admin and compliance officers",
      );
    }

    return true;
  }
}