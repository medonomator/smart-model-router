import { UpstreamEndpoint, UpstreamPool } from '../routing/types';

export interface EndpointSelection {
  readonly endpoint: UpstreamEndpoint;
}

export interface LoadBalancer {
  pick(pool: UpstreamPool): EndpointSelection | null;
  reportFailure(pool: UpstreamPool, endpoint: UpstreamEndpoint): void;
}
