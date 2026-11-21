import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/auth.decorators';
import { CreateOrderDto, ListOrdersQuery } from './dto/order.dto';
import { OrderService } from './order.service';

@ApiTags('订单')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @ApiOperation({ summary: '下单（idempotencyKey 幂等，金额服务端定价）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orderService.createOrder(user, dto);
  }

  @Get()
  @ApiOperation({ summary: '我的订单（分页 + 状态筛选）' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQuery) {
    return this.orderService.listMyOrders(user, query);
  }

  @Get(':orderNo')
  @ApiOperation({ summary: '订单详情（含支付流水与权益）' })
  detail(@CurrentUser() user: AuthUser, @Param('orderNo') orderNo: string) {
    return this.orderService.getOrderDetail(user, orderNo);
  }

  @Post(':orderNo/cancel')
  @ApiOperation({ summary: '取消订单' })
  cancel(@CurrentUser() user: AuthUser, @Param('orderNo') orderNo: string) {
    return this.orderService.cancelOrder(user, orderNo);
  }
}
