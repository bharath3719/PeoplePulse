import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1'); // TR-40
  app.use(helmet());
  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN', 'http://localhost:5173'),
    credentials: true,
  });
  // No global ValidationPipe: we validate with zod (@ZodBody), using the SAME
  // schema the web client imports. One statement of a field's rules, not two.

  const port = config.get<number>('API_PORT', 3000);
  await app.listen(port);

  // DatabaseModule.onApplicationBootstrap has already run by now, and has
  // REFUSED to start if row-level security is not genuinely enforced (ADR-006).
  // If you see this line, tenant isolation is real.
  new Logger('Bootstrap').log(`PeoplePulse API listening on :${port}/api/v1`);
}

void bootstrap();
