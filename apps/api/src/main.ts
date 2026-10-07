import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp, resolveListenHost } from "./app.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app, { requestLogging: true });
  // Render (and most hosts) assign the port through PORT.
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  await app.listen(port, resolveListenHost());
}

void bootstrap();
