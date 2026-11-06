import * as Sentry from "@sentry/nextjs";

import { buildSentryOptions } from "./src/lib/sentry-options";

const options = buildSentryOptions();

if (options) {
  Sentry.init(options);
}
