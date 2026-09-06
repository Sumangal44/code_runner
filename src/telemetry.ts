import { TelemetryReporter } from "@vscode/extension-telemetry";
import * as vscode from "vscode";

import { Constants } from "./constants";

export interface TelemetryProperties {
  [key: string]: string;
}

/**
 * Thin wrapper around the official VS Code telemetry reporter.
 * Respects the user's global telemetry opt-in preference automatically.
 */
export class Telemetry {
  private readonly reporter: TelemetryReporter;
  private readonly enabled: boolean;

  constructor() {
    this.reporter = new TelemetryReporter(Constants.telemetryConnectionString);
    this.enabled = vscode.workspace
      .getConfiguration("code-runner")
      .get<boolean>("enableAppInsights", true);
  }

  sendEvent(eventName: string, properties?: TelemetryProperties): void {
    if (!this.enabled) {
      return;
    }
    // The previous implementation reported "bat" when the event name was empty.
    this.reporter.sendTelemetryEvent(eventName === "" ? "bat" : eventName, properties);
  }

  dispose(): void {
    this.reporter.dispose();
  }
}
