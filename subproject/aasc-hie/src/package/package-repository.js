import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseNavigationPackage } from './package-parser.js';
import { validateNavigationPackage } from './package-validator.js';
import {
  PackageRevisionConflict,
  applyMutationOperations,
  assertCanonicalRevisionEnvelope,
  assertPackageId,
  assertRevisionNumber,
  cloneJson,
  normalizeRevisionMetadata,
} from './package-types.js';

const errorsFor = (value) => validateNavigationPackage(value).filter((item) => item.severity === 'error');

const errorText = (errors) => errors.map((item) => item.message).join('; ');

export class NavigationPackageRepository {
  constructor(options = {}) {
    this.dataRoot = resolve(options.dataRoot ?? 'data');
    this.packages = new Map();
    this.revisions = new Map();
    this.candidateRevisions = new Map();
    this.candidateHeads = new Map();
  }

  async load(filePath) {
    const contents = await readFile(filePath, 'utf8');
    const navigationPackage = parseNavigationPackage(contents, filePath);
    const errors = errorsFor(navigationPackage);
    if (errors.length) throw new Error(`${filePath}: ${errorText(errors)}`);
    const packageId = navigationPackage.metadata.id;
    const revision = navigationPackage.revision ?? 0;
    assertRevisionNumber(revision);
    this.packages.set(packageId, cloneJson(navigationPackage));
    this.revisions.set(packageId, revision);
    this.candidateHeads.delete(packageId);
    for (const key of this.candidateRevisions.keys()) {
      if (key.startsWith(`${packageId}:`)) this.candidateRevisions.delete(key);
    }
    return cloneJson(navigationPackage);
  }

  package(packageId) {
    const id = assertPackageId(packageId);
    const value = this.packages.get(id);
    if (!value) throw new Error(`navigation package is not loaded: ${id}`);
    return cloneJson(value);
  }

  currentRevision(packageId) {
    const id = assertPackageId(packageId);
    if (!this.revisions.has(id)) throw new Error(`navigation package is not loaded: ${id}`);
    return this.revisions.get(id);
  }

  revisionPath(packageId, revision) {
    assertPackageId(packageId);
    assertRevisionNumber(revision);
    return join(this.dataRoot, 'packages', packageId, 'revisions', `${revision}.json`);
  }

  activePath(packageId) {
    return join(this.dataRoot, 'packages', assertPackageId(packageId), 'active.json');
  }

  async saveRevision(packageId, baseRevision, operations, metadata) {
    const id = assertPackageId(packageId);
    assertRevisionNumber(baseRevision, 'baseRevision');
    const current = this.candidateHeads.get(id) ?? this.currentRevision(id);
    if (baseRevision !== current) throw new PackageRevisionConflict(id, baseRevision, current);
    const basePackage = baseRevision === this.currentRevision(id)
      ? this.package(id)
      : this.candidateRevisions.get(`${id}:${baseRevision}`)?.package;
    if (!basePackage) throw new Error(`base revision is not available for package ${id}: ${baseRevision}`);
    const nextPackage = applyMutationOperations(basePackage, operations);
    const errors = errorsFor(nextPackage);
    if (errors.length) throw new Error(`package ${id} failed validation: ${errorText(errors)}`);
    const revision = current + 1;
    const revisionMetadata = normalizeRevisionMetadata(metadata, { requireProvenance: true });
    const packageRevision = {
      packageId: id,
      revision,
      baseRevision,
      package: { ...nextPackage, revision },
      data: { ...nextPackage, revision },
      metadata: revisionMetadata,
      createdAt: new Date().toISOString(),
    };
    assertCanonicalRevisionEnvelope(packageRevision, id);
    const path = this.revisionPath(id, revision);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(packageRevision, null, 2)}\n`, 'utf8');
    this.candidateRevisions.set(`${id}:${revision}`, cloneJson(packageRevision));
    this.candidateHeads.set(id, revision);
    return cloneJson(packageRevision);
  }

  async getRevision(packageId, revision) {
    const id = assertPackageId(packageId);
    assertRevisionNumber(revision);
    const cached = this.candidateRevisions.get(`${id}:${revision}`);
    if (cached) return cloneJson(cached);
    const value = JSON.parse(await readFile(this.revisionPath(id, revision), 'utf8'));
    assertCanonicalRevisionEnvelope(value, id);
    if (value.revision !== revision) throw new Error('stored package revision identity is invalid');
    return value;
  }

  async canonicalRevision(packageId, packageRevision) {
    const id = assertPackageId(packageId);
    const revision = assertCanonicalRevisionEnvelope(packageRevision, id).revision;
    const stored = await this.getRevision(id, revision);
    if (JSON.stringify(stored) !== JSON.stringify(packageRevision)) {
      throw new Error(`revision envelope is not the repository-created revision: ${id}/${revision}`);
    }
    return stored;
  }

  async publishRevision(packageId, packageRevision) {
    const id = assertPackageId(packageId);
    const canonical = await this.canonicalRevision(id, packageRevision);
    const errors = errorsFor(canonical.package);
    if (errors.length) throw new Error(`package ${id} failed validation: ${errorText(errors)}`);
    const active = { ...canonical.package, revision: canonical.revision };
    const path = this.activePath(id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(active, null, 2)}\n`, 'utf8');
    this.packages.set(id, cloneJson(active));
    this.revisions.set(id, canonical.revision);
    this.candidateHeads.delete(id);
    for (const key of this.candidateRevisions.keys()) {
      if (key.startsWith(`${id}:`)) this.candidateRevisions.delete(key);
    }
    return {
      packageId: id,
      revision: canonical.revision,
      path,
      package: cloneJson(active),
      data: cloneJson(active),
    };
  }
}
