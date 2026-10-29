import assert from "node:assert/strict";
import test from "node:test";
import { behaviorAssertions, parseJsonLines, VERIFICATION_CONTRACT } from "../scripts/pi-sdk-smoke-contract.mjs";

const notification = { type: "extension_ui_request", method: "notify", message: "Telegram is not configured. Run /notify-telegram-setup first." };
const prompt = { type: "response", command: "prompt", success: true };
const observed = (responses = [prompt, notification], fullOutput = "", exit_code = 0) =>
  ({ responses, fullOutput, exit_code, expectedVersion: "1.2.0" });

test("behavior contract ID and LF/CRLF JSON parsing", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v3");
  assert.deepEqual(parseJsonLines(`not-json\r\n${JSON.stringify(prompt)}\n\n`), [prompt]);
});

test("reload requires actual second-host command and notification", () => {
  const good = behaviorAssertions("reload_cleanup", observed());
  assert.deepEqual(good.map((a) => a.id), ["reloaded_extension_loaded", "reloaded_feature_response", "clean_shutdown"]);
  assert.ok(good.every((a) => a.passed));
  for (const responses of [[], [prompt], [notification], [{ ...prompt, success: false }, notification]]) {
    assert.ok(behaviorAssertions("reload_cleanup", observed(responses)).some((a) => !a.passed));
  }
});

test("missing setup notification or failed prompt fails", () => {
  assert.equal(behaviorAssertions("happy_path", observed([prompt]))[0].passed, false);
  assert.equal(behaviorAssertions("happy_path", observed([{ ...prompt, success: false }, notification]))[0].passed, false);
  assert.equal(behaviorAssertions("extension_load", observed([{ ...notification, message: "wrong" }]))[0].passed, false);
});

test("cleanup requires exit zero and no runtime/shutdown errors", () => {
  for (const [output, code] of [["shutdown error", 0], ["UnhandledPromiseRejection", 0], ["", 1]]) {
    assert.equal(behaviorAssertions("reload_cleanup", observed(undefined, output, code))[2].passed, false);
  }
});

test("malformed input requires observed handled parse error", () => {
  const error = { type: "response", command: "parse", success: false, error: "Invalid JSON" };
  assert.equal(behaviorAssertions("error_path", observed([error]))[0].passed, true);
  for (const responses of [[], [{ ...error, success: true }], [{ ...error, error: "" }]]) {
    assert.equal(behaviorAssertions("error_path", observed(responses))[0].passed, false);
  }
});

test("native shell returns exact pinned version, not substring/exit alone", () => {
  assert.equal(behaviorAssertions("host_shell", observed([], "1.2.0\r\n"))[0].passed, true);
  for (const value of ["", "11.2.0", "1.2.0 but error", "1.0.0"]) {
    assert.equal(behaviorAssertions("host_shell", observed([], value))[0].passed, false);
  }
});
