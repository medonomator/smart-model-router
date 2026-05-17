export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type UpstreamStatus = 'available' | 'draining' | 'unavailable';

export interface UpstreamEndpoint {
  readonly url: string;
  readonly status: UpstreamStatus;
}

export interface UpstreamPool {
  readonly name: string;
  readonly endpoints: readonly UpstreamEndpoint[];
}

export interface RoutingRule {
  readonly method: HttpMethod;
  readonly path: string;
  readonly pool: string;
}

export interface RouteMatch {
  readonly rule: RoutingRule;
  readonly pool: UpstreamPool;
}

export interface RoutingTable {
  readonly rules: readonly RoutingRule[];
  readonly pools: ReadonlyMap<string, UpstreamPool>;
}
