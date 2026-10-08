import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module.js';
import { BudgetController } from './budget.controller.js';
import { BudgetService } from './budget.service.js';

/**
 * Depends on `UserModule` for one field: the time zone the budget's period is
 * anchored to. A narrow dependency on the profile is better than a second
 * place that decides which day the user is in.
 */
@Module({
  imports: [UserModule],
  controllers: [BudgetController],
  providers: [BudgetService],
  exports: [BudgetService],
})
export class BudgetModule {}
