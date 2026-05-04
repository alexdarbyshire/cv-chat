import { generateObject } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

const { deriveFocusBrief } = await import("./brief");

type AnyMock = ReturnType<typeof vi.mocked<typeof generateObject>>;

function mockBrief(brief: { roleFocus: string; emphasis: string[] }) {
  (vi.mocked(generateObject) as unknown as AnyMock).mockResolvedValue({
    object: brief,
  } as never);
}

describe("deriveFocusBrief", () => {
  beforeEach(() => {
    vi.mocked(generateObject).mockReset();
  });

  it("returns the schema-validated brief from the model", async () => {
    mockBrief({
      roleFocus: "Platform engineering",
      emphasis: ["Kubernetes", "Observability"],
    });

    const result = await deriveFocusBrief([
      { role: "user", content: "tell me about your kubernetes experience" },
      { role: "assistant", content: "..." },
    ]);

    expect(result.roleFocus).toBe("Platform engineering");
    expect(result.emphasis).toEqual(["Kubernetes", "Observability"]);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("only feeds the last 12 messages to the model (token control)", async () => {
    mockBrief({
      roleFocus: "Software engineering",
      emphasis: ["General"],
    });

    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg ${i}`,
    }));

    await deriveFocusBrief(messages);

    const call = vi.mocked(generateObject).mock.calls[0][0] as {
      messages: Array<{ content: string }>;
    };
    expect(call.messages).toHaveLength(12);
    expect(call.messages[0].content).toBe("msg 8");
    expect(call.messages[11].content).toBe("msg 19");
  });
});
