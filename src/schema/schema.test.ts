import { describe, expect, it } from 'vitest';
import { fixtureProject } from './fixtures';
import { createEmptyProject, projectSchema, SCHEMA_VERSION } from './project';

describe('project schema (v7, single compound mechanism)', () => {
  it('accepts a freshly created empty project', () => {
    const p = createEmptyProject('p1', 'New project');
    expect(projectSchema.parse(p)).toEqual(p);
  });

  it('seeds default bomSettings on creation (§6.2)', () => {
    const p = createEmptyProject('p1', 'New project');
    expect(p.bomSettings).toEqual({ heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 });
  });

  it('accepts a project exercising every element type and both pivot joint kinds', () => {
    const p = fixtureProject();
    expect(projectSchema.parse(p)).toEqual(p);
    const jointKinds = p.mechanism.elements
      .filter((e) => e.type === 'pivot')
      .map((e) => (e.type === 'pivot' ? e.joint.kind : ''));
    expect(jointKinds).toContain('hinge');
    expect(jointKinds).toContain('spherical');
    expect(p.groups.length).toBeGreaterThan(0);
    expect(p.pointMasses.some((m) => m.attach.kind === 'node')).toBe(true);
    expect(p.pointMasses.some((m) => m.attach.kind === 'wearerAnchor')).toBe(true);
  });

  it('round-trips through JSON without loss', () => {
    const p = fixtureProject();
    const back = projectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
  });

  it('rejects unknown element types', () => {
    const p = fixtureProject() as unknown as {
      mechanism: { elements: Array<{ type: string }> };
    };
    p.mechanism.elements.push({ type: 'hovercraft' });
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a wrong schemaVersion literal', () => {
    const p = { ...fixtureProject(), schemaVersion: SCHEMA_VERSION + 1 };
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects invalid numeric ranges (telescope with non-positive length)', () => {
    const p = fixtureProject();
    const tel = p.mechanism.elements.find((e) => e.type === 'telescope');
    if (tel?.type !== 'telescope') throw new Error('fixture missing telescope');
    tel.lengthM = 0;
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a pivot without a joint (hinge/spherical is required in v7)', () => {
    const p = fixtureProject() as unknown as {
      mechanism: { elements: Array<Record<string, unknown>> };
    };
    const pivot = p.mechanism.elements.find((e) => e.type === 'pivot')!;
    delete pivot.joint;
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a hinge joint without an axis', () => {
    const p = fixtureProject() as unknown as {
      mechanism: { elements: Array<Record<string, unknown>> };
    };
    const pivot = p.mechanism.elements.find((e) => e.type === 'pivot')!;
    pivot.joint = { kind: 'hinge' };
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects 2D node positions — vec3 with z is required', () => {
    const p = fixtureProject() as unknown as {
      mechanism: { nodes: Array<{ position: Record<string, unknown> }> };
    };
    delete p.mechanism.nodes[0]!.position.z;
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects 2D named-state positions — vec3 with z is required', () => {
    const p = fixtureProject() as unknown as {
      mechanism: { namedStates: Array<{ positions: Record<string, Record<string, unknown>> }> };
    };
    delete p.mechanism.namedStates[0]!.positions.n2!.z;
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a group without a name', () => {
    const p = fixtureProject();
    p.groups[0]!.name = '';
    expect(projectSchema.safeParse(p).success).toBe(false);
  });
});
