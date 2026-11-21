import { SetMetadata } from '@nestjs/common';

/** 标记该路由自行控制响应体（如第三方支付回调），跳过统一响应包装 */
export const RAW_RESPONSE_KEY = 'raw_response';
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
