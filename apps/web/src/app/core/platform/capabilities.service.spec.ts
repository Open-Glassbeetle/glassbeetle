import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { CapabilitiesService } from './capabilities.service';

const MODELS_URL = `${environment.apiBaseUrl}/models`;

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  return {
    capabilities: TestBed.inject(CapabilitiesService),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

function probeRequest(httpMock: HttpTestingController) {
  return httpMock.expectOne((request) => request.url === MODELS_URL);
}

const SURFACE_URLS = {
  projects: `${environment.apiBaseUrl}/projects`,
  artifacts: `${environment.apiBaseUrl}/artifacts`,
  analytics: `${environment.apiBaseUrl}/analytics/usage`,
} as const;

describe('CapabilitiesService', () => {
  afterEach(() => {
    const httpMock = TestBed.inject(HttpTestingController);
    // Every probe() also asks about the other surfaces; answer whatever a test left open.
    for (const url of Object.values(SURFACE_URLS)) {
      httpMock.match((request) => request.url === url).forEach((r) => r.flush({ data: [] }));
    }
    httpMock.verify();
  });

  it('reports nothing as available before the probe runs', () => {
    const { capabilities } = setup();

    expect(capabilities.modelsAvailable()).toBe(false);
    expect(capabilities.probed()).toBe(false);
  });

  it('probes the models endpoint with a single-row GET', () => {
    const { capabilities, httpMock } = setup();

    capabilities.probe();

    const request = probeRequest(httpMock);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('limit')).toBe('1');
    request.flush({ data: [], total: 0 });
  });

  it('marks models available when the endpoint answers', () => {
    const { capabilities, httpMock } = setup();

    capabilities.probe();
    probeRequest(httpMock).flush({ data: [], total: 0 });

    expect(capabilities.modelsAvailable()).toBe(true);
    expect(capabilities.probed()).toBe(true);
  });

  it('treats a 404 as a completed probe: the module is not wired up', () => {
    const { capabilities, httpMock } = setup();

    capabilities.probe();
    probeRequest(httpMock).flush(null, { status: 404, statusText: 'Not Found' });

    expect(capabilities.modelsAvailable()).toBe(false);
    expect(capabilities.probed()).toBe(true);
  });

  // Anything but a 404 says nothing about the capability, so the probe stays
  // unresolved instead of reporting the feature as missing.
  for (const [status, statusText] of [
    [500, 'Internal Server Error'],
    [503, 'Service Unavailable'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
  ] as const) {
    it(`leaves the probe unresolved on a ${status}`, () => {
      const { capabilities, httpMock } = setup();

      capabilities.probe();
      probeRequest(httpMock).flush(null, { status, statusText });

      expect(capabilities.modelsAvailable()).toBe(false);
      expect(capabilities.probed()).toBe(false);
    });
  }

  it('leaves the probe unresolved when the API cannot be reached', () => {
    const { capabilities, httpMock } = setup();

    capabilities.probe();
    probeRequest(httpMock).error(new ProgressEvent('error'), { status: 0 });

    expect(capabilities.modelsAvailable()).toBe(false);
    expect(capabilities.probed()).toBe(false);
  });

  it('resolves on a later probe once the API is reachable again', () => {
    const { capabilities, httpMock } = setup();

    capabilities.probe();
    probeRequest(httpMock).error(new ProgressEvent('error'), { status: 0 });
    capabilities.probe();
    probeRequest(httpMock).flush({ data: [], total: 0 });

    expect(capabilities.modelsAvailable()).toBe(true);
    expect(capabilities.probed()).toBe(true);
  });

  it('withdraws availability when a later probe gets a 404', () => {
    const { capabilities, httpMock } = setup();

    capabilities.probe();
    probeRequest(httpMock).flush({ data: [], total: 0 });
    capabilities.probe();
    probeRequest(httpMock).flush(null, { status: 404, statusText: 'Not Found' });

    expect(capabilities.modelsAvailable()).toBe(false);
    expect(capabilities.probed()).toBe(true);
  });

  describe('surfaces', () => {
    it('start unknown before the probe runs', () => {
      const { capabilities } = setup();

      expect(capabilities.surfaces()).toEqual({
        projects: 'unknown',
        artifacts: 'unknown',
        analytics: 'unknown',
      });
    });

    it('probes each surface with a single-row GET', () => {
      const { capabilities, httpMock } = setup();

      capabilities.probe();

      for (const url of Object.values(SURFACE_URLS)) {
        const request = httpMock.expectOne((r) => r.url === url);
        expect(request.request.method).toBe('GET');
        expect(request.request.params.get('limit')).toBe('1');
        request.flush({ data: [] });
      }
      probeRequest(httpMock).flush({ data: [], total: 0 });
    });

    it('marks a surface available on 2xx and missing only on a definitive 404', () => {
      const { capabilities, httpMock } = setup();

      capabilities.probe();
      httpMock.expectOne((r) => r.url === SURFACE_URLS.projects).flush({ data: [] });
      httpMock
        .expectOne((r) => r.url === SURFACE_URLS.artifacts)
        .flush(null, { status: 404, statusText: 'Not Found' });
      httpMock
        .expectOne((r) => r.url === SURFACE_URLS.analytics)
        .flush(null, { status: 503, statusText: 'Service Unavailable' });
      probeRequest(httpMock).flush({ data: [], total: 0 });

      expect(capabilities.surfaces()).toEqual({
        projects: 'available',
        artifacts: 'missing',
        analytics: 'unknown',
      });
    });
  });
});
