import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45000,
  expect: { timeout: 12000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PRACTICE_TEST_URL || "http://localhost:5189",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5189",
    url: "http://localhost:5189",
    reuseExistingServer: true,
  },
  projects: [
    {
      name: "tab-webkit",
      testMatch: "**/tab-recognition.spec.ts",
      grep: /real TAB PNG|rhythm symbols: explicit|rhythm symbols: double|mobile tie correction|repeat mobile review/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "tab",
      testMatch: "**/tab-recognition.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.PRACTICE_SILENT_SINK === "1" ? ["--disable-audio-output"] : [],
        },
      },
    },
    {
      name: "omr",
      testMatch: "**/recognition.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.PRACTICE_SILENT_SINK === "1" ? ["--disable-audio-output"] : [],
        },
      },
    },
    {
      name: "chromium",
      testIgnore: [
        "**/compatibility.spec.ts",
        "**/recognition.spec.ts",
        "**/tab-recognition.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: process.env.PRACTICE_SILENT_SINK === "1" ? ["--disable-audio-output"] : [],
        },
      },
    },
    {
      name: "webkit",
      testMatch: ["**/compatibility.spec.ts", "**/pdf-audio.spec.ts", "**/auto-alignment.spec.ts"],
      use: { ...devices["iPhone 13"] },
    },
  ],
});
