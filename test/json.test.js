import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runScx } from "./helpers.js";

function runJson(args, input) {
  const baseArgs = ["-c", "JPY", "-r", "155", "-l", "ja-JP", "--json", ...args];
  return runScx(baseArgs, typeof input === "string" ? input : JSON.stringify(input));
}

function parseJson(args, input) {
  const { stdout, status, stderr } = runJson(args, input);
  assert.equal(status, 0, `non-zero exit: ${stderr}`);
  return JSON.parse(stdout);
}

describe("--json default keys (numeric output)", () => {
  test("converts totalCost in ccusage daily-like payload", () => {
    const out = parseJson([], {
      daily: [{ period: "2026-04-22", totalCost: 19.18, totalTokens: 1234 }],
      totals: { totalCost: 19.18, totalTokens: 1234 },
    });
    assert.equal(out.daily[0].totalCost, 2973);
    assert.equal(out.totals.totalCost, 2973);
  });

  test("converts costUSD in blocks-like payload", () => {
    const out = parseJson([], {
      blocks: [{ id: "x", costUSD: 0.67221625, totalTokens: 357861 }],
    });
    assert.equal(out.blocks[0].costUSD, 104);
  });

  test("converts cost inside modelBreakdowns", () => {
    const out = parseJson([], {
      daily: [
        {
          totalCost: 1,
          modelBreakdowns: [
            { modelName: "claude-opus-4-7", cost: 0.5 },
            { modelName: "claude-haiku-4-5", cost: 0.25 },
          ],
        },
      ],
    });
    assert.equal(out.daily[0].modelBreakdowns[0].cost, 78);
    assert.equal(out.daily[0].modelBreakdowns[1].cost, 39);
  });

  test("converts costPerHour inside burnRate (deeply nested)", () => {
    const out = parseJson([], {
      blocks: [
        {
          costUSD: 1,
          burnRate: { tokensPerMinute: 58750, costPerHour: 6.62 },
        },
      ],
    });
    assert.equal(out.blocks[0].burnRate.costPerHour, 1026);
    assert.equal(out.blocks[0].burnRate.tokensPerMinute, 58750);
  });

  test("leaves non-cost numeric fields untouched", () => {
    const out = parseJson([], {
      daily: [
        {
          inputTokens: 14518,
          outputTokens: 123926,
          totalTokens: 31343076,
          totalCost: 19.18,
        },
      ],
    });
    assert.equal(out.daily[0].inputTokens, 14518);
    assert.equal(out.daily[0].outputTokens, 123926);
    assert.equal(out.daily[0].totalTokens, 31343076);
    assert.equal(out.daily[0].totalCost, 2973);
  });

  test("leaves null cost values as-is", () => {
    const out = parseJson([], { totalCost: null });
    assert.equal(out.totalCost, null);
  });

  test("leaves string cost values as-is", () => {
    const out = parseJson([], { totalCost: "19.18" });
    assert.equal(out.totalCost, "19.18");
  });
});

describe("--json currency-specific rounding (numeric output)", () => {
  test("JPY rounds to integer", () => {
    const { stdout, status } = runScx(
      ["-c", "JPY", "-r", "155", "-l", "ja-JP", "--json"],
      JSON.stringify({ totalCost: 19.18 }),
    );
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.totalCost, 2973);
    assert.equal(Number.isInteger(out.totalCost), true);
  });

  test("USD keeps 2 decimal places", () => {
    const { stdout, status } = runScx(
      ["-c", "USD", "-r", "1", "-l", "en-US", "--json"],
      JSON.stringify({ totalCost: 19.18567 }),
    );
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.totalCost, 19.19);
  });

  test("KWD keeps 3 decimal places", () => {
    const { stdout, status } = runScx(
      ["-c", "KWD", "-r", "0.3", "-l", "en-US", "--json"],
      JSON.stringify({ totalCost: 1 }),
    );
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.totalCost, 0.3);
  });
});

describe("--json floating point edge cases", () => {
  test("USD: 1.005 rounds to 1.01 (not 1.00 from naive Math.round)", () => {
    const { stdout } = runScx(
      ["-c", "USD", "-r", "1", "-l", "en-US", "--json"],
      JSON.stringify({ totalCost: 1.005 }),
    );
    const out = JSON.parse(stdout);
    assert.equal(out.totalCost, 1.01);
  });

  test("USD: 19.185 rounds to 19.19", () => {
    const { stdout } = runScx(
      ["-c", "USD", "-r", "1", "-l", "en-US", "--json"],
      JSON.stringify({ totalCost: 19.185 }),
    );
    const out = JSON.parse(stdout);
    assert.equal(out.totalCost, 19.19);
  });

  test("USD: 0.1 + 0.2 accumulated error is normalized", () => {
    const { stdout } = runScx(
      ["-c", "USD", "-r", "1", "-l", "en-US", "--json"],
      JSON.stringify({ totalCost: 0.1 + 0.2 }),
    );
    const out = JSON.parse(stdout);
    assert.equal(out.totalCost, 0.3);
  });

  test("numeric and string modes round to the same value", () => {
    const cases = [1.005, 19.185, 2.675, 0.1 + 0.2, 100.005];
    for (const value of cases) {
      const num = runScx(
        ["-c", "USD", "-r", "1", "-l", "en-US", "--json"],
        JSON.stringify({ totalCost: value }),
      );
      const str = runScx(
        ["-c", "USD", "-r", "1", "-l", "en-US", "--json", "--json-cost-string"],
        JSON.stringify({ totalCost: value }),
      );
      const numericOut = JSON.parse(num.stdout).totalCost;
      const stringOut = JSON.parse(str.stdout).totalCost;
      const stringDigits = stringOut.replace(/[^\d.-]/g, "");
      assert.equal(
        Number(stringDigits),
        numericOut,
        `mismatch for input ${value}: numeric=${numericOut} string=${stringOut}`,
      );
    }
  });
});

describe("--json-cost-string (formatted string output)", () => {
  test("replaces cost numbers with formatted currency strings", () => {
    const { stdout, status } = runScx(
      ["-c", "JPY", "-r", "155", "-l", "ja-JP", "--json", "--json-cost-string"],
      JSON.stringify({ totalCost: 19.18 }),
    );
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.equal(typeof out.totalCost, "string");
    assert.match(out.totalCost, /￥2,973/);
  });

  test("keeps non-cost numeric fields as numbers", () => {
    const { stdout, status } = runScx(
      ["-c", "JPY", "-r", "155", "-l", "ja-JP", "--json", "--json-cost-string"],
      JSON.stringify({ totalCost: 19.18, totalTokens: 31343076 }),
    );
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.equal(typeof out.totalCost, "string");
    assert.equal(typeof out.totalTokens, "number");
    assert.equal(out.totalTokens, 31343076);
  });
});

describe("--json-key (extra keys)", () => {
  test("adds a single key to the default set", () => {
    const out = parseJson(["--json-key", "myCustomCost"], {
      myCustomCost: 1,
      totalCost: 2,
      somethingElse: 3,
    });
    assert.equal(out.myCustomCost, 155);
    assert.equal(out.totalCost, 310);
    assert.equal(out.somethingElse, 3);
  });

  test("accepts comma-separated keys", () => {
    const out = parseJson(["--json-key", "fee,extra"], {
      fee: 1,
      extra: 2,
      noise: 3,
    });
    assert.equal(out.fee, 155);
    assert.equal(out.extra, 310);
    assert.equal(out.noise, 3);
  });

  test("accepts the flag multiple times", () => {
    const out = parseJson(["--json-key", "fee", "--json-key", "extra"], {
      fee: 1,
      extra: 2,
    });
    assert.equal(out.fee, 155);
    assert.equal(out.extra, 310);
  });
});

describe("--json arrays and nesting", () => {
  test("handles top-level arrays", () => {
    const out = parseJson([], [{ totalCost: 1 }, { totalCost: 2 }]);
    assert.equal(out[0].totalCost, 155);
    assert.equal(out[1].totalCost, 310);
  });

  test("recurses into arrays of arrays", () => {
    const out = parseJson([], { x: [[{ cost: 1 }]] });
    assert.equal(out.x[0][0].cost, 155);
  });

  test("preserves array order", () => {
    const out = parseJson([], { items: [{ cost: 1 }, { cost: 2 }, { cost: 3 }] });
    assert.deepEqual(
      out.items.map((it) => it.cost),
      [155, 310, 465],
    );
  });
});

describe("--json parse errors", () => {
  test("exits 1 on invalid JSON", () => {
    const { status, stderr } = runScx(["-c", "JPY", "-r", "155", "--json"], "not json at all");
    assert.equal(status, 1);
    assert.match(stderr, /json/i);
  });

  test("exits 1 on truncated JSON", () => {
    const { status } = runScx(["-c", "JPY", "-r", "155", "--json"], '{"a": 1');
    assert.equal(status, 1);
  });
});

describe("--json output format", () => {
  test("output is pretty-printed with 2-space indent", () => {
    const { stdout } = runScx(
      ["-c", "JPY", "-r", "155", "--json"],
      JSON.stringify({ totalCost: 1 }),
    );
    assert.match(stdout, /\n {2}"totalCost"/);
  });

  test("output ends with a single trailing newline", () => {
    const { stdout } = runScx(
      ["-c", "JPY", "-r", "155", "--json"],
      JSON.stringify({ totalCost: 1 }),
    );
    assert.equal(stdout.endsWith("\n"), true);
    assert.equal(stdout.endsWith("\n\n"), false);
  });
});
