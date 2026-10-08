import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/http/api-error.js';
import { BudgetService } from './budget.service.js';
import { BudgetResponseDto } from './dto/budget-response.dto.js';
import { UpdateBudgetDto } from './dto/update-budget.dto.js';

@ApiTags('budget')
@Controller('budget')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get()
  @ApiOperation({
    summary: 'Retrieve the spending budget and the spend against it',
    description: `Returns the budget together with what has been spent against it in the current period.

Always succeeds and never 404s: like the user profile, the budget is a singleton every installation has, provisioned on first read with no limit set.

The period is anchored to local midnight in the time zone on the user profile, so a daily budget renews when the user's day does rather than when UTC's does. Spend is summed from \`usage_events.cost_usd\`; amounts are US dollars, because that column is.`,
  })
  @ApiOkResponse({
    description: 'The budget and the current period',
    type: BudgetResponseDto,
  })
  async find(): Promise<BudgetResponseDto> {
    return this.budgetService.find();
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the spending budget',
    description: `Applies partial updates to the budget (PATCH). Only supplied fields are changed.

\`limitUsd: null\` removes the budget: spending is still reported, it is simply not measured against anything. An empty body is an idempotent no-op and leaves \`updatedAt\` untouched.`,
  })
  @ApiOkResponse({
    description: 'The updated budget and the current period',
    type: BudgetResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Request validation failed (e.g. a limit outside the accepted range, more than two decimal places, an unknown period, or a client-supplied server-managed field)',
    type: ApiErrorResponseDto,
  })
  async update(@Body() dto: UpdateBudgetDto): Promise<BudgetResponseDto> {
    return this.budgetService.update(dto);
  }
}
