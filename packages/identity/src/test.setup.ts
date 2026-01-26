import { TextEncoder, TextDecoder } from "util";

global.TextEncoder = TextEncoder;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
global.TextDecoder = TextDecoder as any;
