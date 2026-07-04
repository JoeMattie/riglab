import { conformanceSuite } from '../harness/conformance';
import { XpbdAdapter } from './xpbd';

conformanceSuite('custom-xpbd', () => new XpbdAdapter());
