import { conformanceSuite } from '../harness/conformance';
import { PlanckAdapter } from './planck';

conformanceSuite('planck', () => new PlanckAdapter());
