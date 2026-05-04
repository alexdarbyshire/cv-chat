import { registerOTel } from "@vercel/otel";

export async function register() {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_RUNTIME === "nodejs"
  ) {
    const { TidewaveSpanProcessor, TidewaveLogRecordProcessor } = await import(
      "tidewave/next-js/instrumentation"
    );
    registerOTel({
      serviceName: "chatbot",
      spanProcessors: [new TidewaveSpanProcessor()],
      logRecordProcessor: new TidewaveLogRecordProcessor(),
    });
    return;
  }
  registerOTel({ serviceName: "chatbot" });
}
