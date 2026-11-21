import { Inject, Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, randomBytes, X509Certificate } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_CONFIG, AppConfig } from '../../config/app-config';

export interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  privatePem: string;
  publicPem: string;
}

/**
 * 沙箱密钥管理：
 * - 真实环境：读取商户私钥 / 平台公钥文件（私钥永不入库、不打日志）；
 * - 沙箱环境：文件不存在时自动生成 RSA-2048 密钥对并落盘到 storage/sandbox，
 *   因此本地可以完整跑通「签名 → 验签 → 解密」全流程，不需要外网。
 */
@Injectable()
export class PaymentKeyService {
  private readonly logger = new Logger(PaymentKeyService.name);
  private readonly cache = new Map<string, KeyPair>();
  private apiV3Cache: Buffer | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private loadOrGenerate(label: string, privatePath: string, publicPath?: string): KeyPair {
    const cachedKey = this.cache.get(label);
    if (cachedKey) return cachedKey;

    let keyPair: KeyPair | null = null;
    if (fs.existsSync(privatePath)) {
      const privatePem = fs.readFileSync(privatePath, 'utf8');
      const privateKey = this.parsePrivate(privatePem);
      const publicPem = publicPath && fs.existsSync(publicPath) ? fs.readFileSync(publicPath, 'utf8') : null;
      keyPair = {
        privateKey,
        publicKey: publicPem ? this.parsePublic(publicPem) : createPublicKey(privateKey),
        privatePem,
        publicPem: publicPem ?? privatePem,
      };
      this.logger.log(`已加载沙箱/正式密钥：${label} (${privatePath})`);
    }

    if (!keyPair) {
      const isSandbox = !this.config.isProd;
      if (!isSandbox) {
        throw new Error(`缺少支付密钥文件：${privatePath}，生产环境必须显式配置`);
      }
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      keyPair = {
        privateKey: this.parsePrivate(privateKey),
        publicKey: this.parsePublic(publicKey),
        privatePem: privateKey,
        publicPem: publicKey,
      };
      this.persist(privatePath, keyPair.privatePem);
      if (publicPath) this.persist(publicPath, keyPair.publicPem);
      this.logger.warn(`沙箱环境自动生成密钥：${label} → ${privatePath}（正式环境请替换为真实密钥并在 .env 指定路径）`);
    }

    this.cache.set(label, keyPair);
    return keyPair;
  }

  private persist(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, { mode: 0o600 });
  }

  private parsePrivate(pem: string): KeyObject {
    return createPrivateKey(pem);
  }

  private parsePublic(pem: string): KeyObject {
    try {
      return createPublicKey(pem);
    } catch {
      return new X509Certificate(pem).publicKey;
    }
  }

  /** 微信商户 API 私钥（apiclient_key.pem） */
  wechatMerchant(): KeyPair {
    return this.loadOrGenerate('wechat-merchant', this.config.pay.wechat.privateKeyPath);
  }

  /** 微信支付平台证书公钥；沙箱下同时生成平台私钥，供本地模拟回调签名 */
  wechatPlatform(): KeyPair {
    const publicPath = this.config.pay.wechat.platformCertPath;
    const platformPrivate = path.join(path.dirname(publicPath), 'wechat_platform_private.pem');
    return this.loadOrGenerate('wechat-platform', platformPrivate, publicPath);
  }

  /** 支付宝应用私钥 / 支付宝平台公钥（沙箱下自签名模拟） */
  alipayApp(): KeyPair {
    return this.loadOrGenerate('alipay-app', this.config.pay.alipay.privateKeyPath);
  }

  alipayPlatform(): KeyPair {
    const publicPath = this.config.pay.alipay.publicKeyPath;
    const platformPrivate = path.join(path.dirname(publicPath), 'alipay_platform_private.pem');
    return this.loadOrGenerate('alipay-platform', platformPrivate, publicPath);
  }

  /** APIv3 密钥：32 字节，用于 AES-256-GCM 解密回调 resource */
  apiV3Key(): Buffer {
    if (this.apiV3Cache) return this.apiV3Cache;
    const configured = this.config.pay.wechat.apiV3Key;
    if (configured && Buffer.byteLength(configured, 'utf8') === 32) {
      this.apiV3Cache = Buffer.from(configured, 'utf8');
      return this.apiV3Cache;
    }
    if (configured) {
      this.logger.warn('WECHAT_API_V3_KEY 长度不是 32 字节，沙箱下改用自动生成密钥');
    }
    const keyFile = path.join(path.dirname(this.config.pay.wechat.privateKeyPath), 'wechat_apiv3.key');
    if (fs.existsSync(keyFile)) {
      this.apiV3Cache = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
      return this.apiV3Cache;
    }
    const generated = randomBytes(32);
    this.persist(keyFile, generated.toString('base64'));
    this.logger.warn(`沙箱自动生成 APIv3 Key → ${keyFile}（正式环境从微信商户平台下载并写入 WECHAT_API_V3_KEY）`);
    this.apiV3Cache = generated;
    return this.apiV3Cache;
  }
}
