import type { Portal } from "../../lib/types";
import { linkedin } from "./linkedin";
import { monster } from "./monster";
import { naukri } from "./naukri";
import type { PortalAdapter } from "./types";

export const ADAPTERS: Record<Portal, PortalAdapter> = { naukri, linkedin, monster };
