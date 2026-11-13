import { NavigationPackageRepository } from './package-repository.js';
import { validateNavigationPackage } from './package-validator.js';
import {
  assertCanonicalRevisionEnvelope,
  assertPackageId,
  assertRevisionNumber,
  normalizeRevisionMetadata,
  applyMutationOperations,
} from './package-types.js';

const packageFromRevision = (revision) => revision?.package ?? revision?.data ?? revision;

export class NavigationDataService {
  constructor(options = {}) {
    this.repository = options.repository ?? new NavigationPackageRepository(options);
  }

  load(filePath) {
    return this.repository.load(filePath);
  }

  async apply(packageId, request) {
    const id = assertPackageId(packageId);
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('mutation request must be an object');
    assertRevisionNumber(request.baseRevision, 'baseRevision');
    const metadata = normalizeRevisionMetadata({
      ...(request.metadata ?? {}),
      author: request.author,
      ...(request.source === undefined ? {} : { source: request.source }),
    });
    return this.repository.saveRevision(id, request.baseRevision, request.operations, metadata);
  }

  /**
   * Validate an already supplied envelope synchronously, or look up a numeric
   * revision asynchronously for compatibility with the original contract.
   */
  validate(packageId, revision) {
    const id = assertPackageId(packageId);
    if (typeof revision === 'number') {
      return this.validateStored(id, revision);
    }
    const canonical = assertCanonicalRevisionEnvelope(revision, id);
    return validateNavigationPackage(packageFromRevision(canonical));
  }

  /** Validate proposed operations against the currently loaded package without writing a revision. */
  validateOperations(packageId, baseRevision, operations) {
    const id = assertPackageId(packageId);
    assertRevisionNumber(baseRevision, 'baseRevision');
    if (baseRevision !== this.repository.currentRevision(id)) {
      return [{ severity: 'error', code: 'revision-conflict', message: `base revision ${baseRevision} is not current` }];
    }
    try {
      const nextPackage = applyMutationOperations(this.repository.package(id), operations);
      return validateNavigationPackage({ ...nextPackage, revision: baseRevision + 1 });
    } catch (error) {
      return [{ severity: 'error', code: 'invalid-operation', message: error.message }];
    }
  }

  async validateStored(packageId, revision) {
    const id = assertPackageId(packageId);
    assertRevisionNumber(revision);
    const canonical = await this.repository.canonicalRevision(id, await this.repository.getRevision(id, revision));
    return this.validate(id, canonical);
  }

  async publish(packageId, revision) {
    const id = assertPackageId(packageId);
    const value = typeof revision === 'number' ? await this.repository.getRevision(id, revision) : revision;
    const canonical = await this.repository.canonicalRevision(id, value);
    const diagnostics = this.validate(id, canonical);
    const errors = diagnostics.filter((item) => item.severity === 'error');
    if (errors.length) throw new Error(`package ${id} failed validation: ${errors.map((item) => item.message).join('; ')}`);
    return this.repository.publishRevision(id, canonical);
  }
}
