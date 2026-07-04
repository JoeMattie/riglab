import { describe, expect, it } from 'vitest';
import { fixtureProject } from './fixtures';
import { createEmptyProject, projectSchema, SCHEMA_VERSION } from './project';

describe('project schema v1', () => {
  it('accepts a freshly created empty project', () => {
    const p = createEmptyProject('p1', 'New project');
    expect(projectSchema.parse(p)).toEqual(p);
  });

  it('seeds default bomSettings on creation (§6.2)', () => {
    const p = createEmptyProject('p1', 'New project');
    expect(p.bomSettings).toEqual({ heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 });
  });

  it('accepts a project exercising every element type', () => {
    const p = fixtureProject();
    expect(projectSchema.parse(p)).toEqual(p);
  });

  it('round-trips through JSON without loss', () => {
    const p = fixtureProject();
    const back = projectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
  });

  it('rejects unknown element types', () => {
    const p = fixtureProject() as unknown as {
      mechanisms: Array<{ elements: Array<{ type: string }> }>;
    };
    p.mechanisms[0]!.elements.push({ type: 'hovercraft' });
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a wrong schemaVersion literal', () => {
    const p = { ...fixtureProject(), schemaVersion: SCHEMA_VERSION + 1 };
    expect(projectSchema.safeParse(p).success).toBe(false);
  });

  it('rejects invalid numeric ranges (telescope with non-positive length)', () => {
    const p = fixtureProject();
    const tel = p.mechanisms[0]!.elements.find((e) => e.type === 'telescope');
    if (tel?.type !== 'telescope') throw new Error('fixture missing telescope');
    tel.lengthM = 0;
    expect(projectSchema.safeParse(p).success).toBe(false);
  });
});
