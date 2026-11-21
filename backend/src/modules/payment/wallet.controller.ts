import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/auth.decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { WalletService } from './wallet.service';

@ApiTags('钱包')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('me')
  @ApiOperation({ summary: '我的钱包余额' })
  me(@CurrentUser() user: AuthUser) {
    return this.wallet.getWallet(user.id);
  }

  @Get('transactions')
  @ApiOperation({ summary: '余额流水（分页）' })
  transactions(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
    return this.wallet.listTransactions(user.id, query.page ?? 1, query.pageSize ?? 20);
  }
}
