/**
 * PostHog SDK, imported only by posthog-loader.ts (on the visitor's first input).
 *
 * The full npm build (~105 KB compressed) is used on purpose. posthog-js 1.436's "slim" build is half
 * that size, but only without extensions: its prebuilt extension bundle repeats the SDK core, so
 * slim + session replay or web vitals measured LARGER (~113 KB) than the full build. Slim alone drops
 * session replay, autocapture, heatmaps and $web_vitals, which §19 and §28 rely on. Keeping the
 * full SDK off the PageSpeed lab run is the loader's job, not this file's.
 *
 * Person profiles stay off (no visitor is identified), recordings mask every input so lead-form
 * names, phones and emails are never captured, and every event is tagged with the client (slug + name,
 * the shared "RGP - Clients" project holds every client site) and preview|production.
 */
import posthog from 'posthog-js';

type Config = { key: string; apiHost: string; environment: 'preview' | 'production'; client: string; clientName: string };

export function initPostHog({ key, apiHost, environment, client, clientName }: Config): void {
  if (!key || !client) return;
  posthog.init(key, {
    api_host: apiHost,
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    session_recording: { maskAllInputs: true },
    capture_performance: { web_vitals: true },
  });
  posthog.register({ environment, client, client_name: clientName });
}
