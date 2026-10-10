import assert from "node:assert/strict";
import test from "node:test";
import { GoogleAuthError, verifyGoogleIdToken } from "./google.js";

test("verifyGoogleIdToken reports unavailable when client id is missing", async () => {
  await assert.rejects(
    () => verifyGoogleIdToken(null, "token"),
    (error: unknown) => {
      assert.ok(error instanceof GoogleAuthError);
      assert.equal(error.code, "UNAVAILABLE");
      return true;
    },
  );
});

test("verifyGoogleIdToken rejects an empty token", async () => {
  await assert.rejects(
    () => verifyGoogleIdToken("client-id.apps.googleusercontent.com", "  "),
    (error: unknown) => {
      assert.ok(error instanceof GoogleAuthError);
      assert.equal(error.code, "INVALID_TOKEN");
      return true;
    },
  );
});
