import { conformanceSuite } from '../harness/conformance';
import { RapierAdapter } from './rapier';

conformanceSuite('rapier2d', () => new RapierAdapter());
