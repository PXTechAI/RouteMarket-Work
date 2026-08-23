import type { RefObject } from "react";
import type {
  AttachedBrowserState,
  AttachedBrowserTarget,
  ManagedBrowserProfileInput,
  ManagedBrowserState
} from "../../../../shared/desktop-api";

export type BrowserMode = "managed" | "attached";
export type BrowserNavigationAction = "back" | "forward" | "reload";

export type BrowserPageModel = {
  localProjectId: string | null;
  mode: BrowserMode;
  state: ManagedBrowserState | null;
  address: string;
  busy: boolean;
  screenshot: string | null;
  attachedEndpoint: string;
  attachedTargets: AttachedBrowserTarget[];
  selectedAttachedTargetId: string;
  attachedState: AttachedBrowserState;
  error: string | null;
};

export type BrowserPageActions = {
  onModeChange(mode: BrowserMode): void;
  onNavigate(action: BrowserNavigationAction): void;
  onAddressChange(value: string): void;
  onAddressSubmit(): void;
  onToggleTakeover(): void;
  onCreatePage(profileId?: string): void;
  onSelectPage(pageId: string): void;
  onClosePage(pageId: string): void;
  onCreateProfile(input: ManagedBrowserProfileInput): void;
  onUpdateProfile(profileId: string, input: ManagedBrowserProfileInput): void;
  onDeleteProfile(profileId: string): void;
  onCaptureScreenshot(): void;
  onRetryOperation(operationId: string): void;
  onCloseScreenshot(): void;
  onAttachedEndpointChange(value: string): void;
  onDiscoverAttachedTargets(): void;
  onSelectedAttachedTargetChange(value: string): void;
  onToggleAttachedConnection(): void;
  onDismissError(): void;
  onViewportLayoutChange(): void;
};

export type BrowserPageProps = {
  model: BrowserPageModel;
  actions: BrowserPageActions;
  viewportRef: RefObject<HTMLDivElement | null>;
  addressRef: RefObject<HTMLInputElement | null>;
};
