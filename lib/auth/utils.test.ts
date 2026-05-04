import { describe, expect, it } from "vitest";
import { isHttpsRequest } from "./utils";

function makeReq(opts: {
  forwardedProto?: string | null;
  url?: string;
  nextUrl?: { protocol: string };
}) {
  const headers = new Map<string, string>();
  if (opts.forwardedProto !== undefined && opts.forwardedProto !== null) {
    headers.set("x-forwarded-proto", opts.forwardedProto);
  }
  return {
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    url: opts.url,
    nextUrl: opts.nextUrl,
  };
}

describe("isHttpsRequest", () => {
  it("returns true when x-forwarded-proto is https (reverse-proxy case)", () => {
    expect(
      isHttpsRequest(
        makeReq({
          forwardedProto: "https",
          url: "http://localhost:3000/",
          nextUrl: { protocol: "http:" },
        })
      )
    ).toBe(true);
  });

  it("returns false when x-forwarded-proto is http", () => {
    expect(
      isHttpsRequest(
        makeReq({
          forwardedProto: "http",
          nextUrl: { protocol: "https:" },
        })
      )
    ).toBe(false);
  });

  it("uses the first value when x-forwarded-proto is a comma-separated list", () => {
    expect(isHttpsRequest(makeReq({ forwardedProto: "https, http" }))).toBe(
      true
    );
    expect(isHttpsRequest(makeReq({ forwardedProto: "http, https" }))).toBe(
      false
    );
  });

  it("falls back to nextUrl.protocol when no x-forwarded-proto header", () => {
    expect(isHttpsRequest(makeReq({ nextUrl: { protocol: "https:" } }))).toBe(
      true
    );
    expect(isHttpsRequest(makeReq({ nextUrl: { protocol: "http:" } }))).toBe(
      false
    );
  });

  it("falls back to req.url when neither header nor nextUrl is present", () => {
    expect(isHttpsRequest(makeReq({ url: "https://example.com/" }))).toBe(true);
    expect(isHttpsRequest(makeReq({ url: "http://example.com/" }))).toBe(false);
  });

  it("returns false when nothing identifies the protocol", () => {
    expect(isHttpsRequest(makeReq({}))).toBe(false);
  });
});
