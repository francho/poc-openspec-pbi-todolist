import { describe, expect, it } from "vitest";

import {
  FinalPullRequestBodyError,
  renderFinalPullRequestBody,
} from "../src/final-pr-body.js";
import type {
  FinalPullRequestBodyInput,
  FinalReferenceResolver,
} from "../src/final-pr-body.js";
import { renderManagedBlock } from "../src/markers.js";

const archiveCommitSha = "a".repeat(40);
const sliceCommitSha = "b".repeat(40);
const pbiUrl = "https://github.com/acme/shop/issues/42";
const sliceUrl = "https://github.com/acme/shop/issues/101";
const checkUrl = "https://github.com/acme/shop/actions/runs/123";

class StubResolver implements FinalReferenceResolver {
  readonly references: string[] = [];

  constructor(private readonly unresolved?: string) {}

  issueResolves(url: string): Promise<boolean> {
    this.references.push(`issue:${url}`);
    return Promise.resolve(url !== this.unresolved);
  }

  commitResolves(sha: string): Promise<boolean> {
    this.references.push(`commit:${sha}`);
    return Promise.resolve(sha !== this.unresolved);
  }

  checkResolves(url: string): Promise<boolean> {
    this.references.push(`check:${url}`);
    return Promise.resolve(url !== this.unresolved);
  }
}

const input: FinalPullRequestBodyInput = {
  existingBody: `Human-owned introduction.\n\n${renderManagedBlock("pull-request", "pbi-42", JSON.stringify({ purpose: "pbi-42" }))}\n`,
  pbiNumber: 42,
  pbiUrl,
  archiveCommitSha,
  slices: [{ id: "T01", title: "Generate release notes", issueUrl: sliceUrl, commitSha: sliceCommitSha }],
  verification: [{ name: "build-and-test", checkUrl, evidence: "134 tests passed" }],
  gates: [
    { gate: "documentation", verdict: "pass", evidence: ["All changed docs reviewed"] },
    { gate: "qa", verdict: "pass", evidence: ["Acceptance and scenarios traced"] },
    { gate: "demo-preparation", verdict: "not-applicable", evidence: ["No interactive entry point"] },
    { gate: "demo-approval", verdict: "pass", evidence: ["Accepted by trusted human"] },
  ],
  demoEvidence: [
    "Non-applicable disposition accepted for the current SHA",
    { label: "Demo manifest", path: "artifacts/demo/current/manifest.json" },
  ],
  mergeRisk: { level: "low", assessment: "Changes are isolated and fully covered by the verification matrix." },
};

describe("final PBI pull request body", () => {
  it("resolves every issue, commit, and check before replacing only its managed body", async () => {
    const resolver = new StubResolver();
    const body = await renderFinalPullRequestBody(input, resolver);

    expect(resolver.references).toEqual([
      `issue:${pbiUrl}`,
      `commit:${archiveCommitSha}`,
      `issue:${sliceUrl}`,
      `commit:${sliceCommitSha}`,
      `check:${checkUrl}`,
    ]);
    expect(body).toContain("Human-owned introduction.");
    expect(body).toContain("## Delivered Slices");
    expect(body).toContain("## Verification");
    expect(body).toContain("## Completion Gates");
    expect(body).toContain("## Demo Evidence");
    expect(body).toContain(`[Demo manifest](https://github.com/acme/shop/blob/${archiveCommitSha}/artifacts/demo/current/manifest.json)`);
    expect(body).toContain("## Merge Risk");
    expect(body).not.toContain('{"purpose":"pbi-42"}');
  });

  it.each([pbiUrl, archiveCommitSha, sliceUrl, sliceCommitSha, checkUrl])(
    "rejects an unresolved reference without generating a body: %s",
    async (unresolved) => {
      await expect(renderFinalPullRequestBody(input, new StubResolver(unresolved)))
        .rejects.toThrow(FinalPullRequestBodyError);
    },
  );

  it("requires every final evidence section", async () => {
    await expect(renderFinalPullRequestBody({ ...input, demoEvidence: [] }, new StubResolver()))
      .rejects.toThrow(/Demo evidence/u);
    await expect(renderFinalPullRequestBody({ ...input, mergeRisk: { level: "low", assessment: "" } }, new StubResolver()))
      .rejects.toThrow(/Merge-risk/u);
  });

  it("rejects demo artifact paths outside the repository evidence directory", async () => {
    await expect(renderFinalPullRequestBody({
      ...input,
      demoEvidence: [{ label: "Unsafe", path: "../secret.txt" }],
    }, new StubResolver())).rejects.toThrow(/Invalid demo artifact path/u);
  });
});