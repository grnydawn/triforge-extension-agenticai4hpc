import {
  ActivityBar,
  SideBarView,
  ViewContent,
  ViewSection,
} from 'vscode-extension-tester';

/** Activity-bar container title contributed by the extension (`triforge-activitybar`). */
export const TRIFORGE_VIEW_TITLE = 'Triforge';

/** Tree view titles / webview view title contributed under the Triforge container. */
export const PROJECTS_SECTION_TITLE = 'Projects';
export const SIMULATIONS_SECTION_TITLE = 'Simulations';
export const PROPERTIES_SECTION_TITLE = 'Properties';

/**
 * Page object for the Triforge side bar.
 *
 * Opens the Triforge activity-bar container and exposes its content sections:
 * the `Projects` and `Simulations` tree views and the `Properties` webview
 * view. Keeps suites from hand-rolling ActivityBar / SideBarView wiring.
 */
export class Sidebar {
  /**
   * Open the Triforge view container from the activity bar and return its
   * {@link SideBarView}.
   * @throws if the Triforge activity-bar control is not present
   */
  async openTriforge(): Promise<SideBarView> {
    const control = await new ActivityBar().getViewControl(TRIFORGE_VIEW_TITLE);
    if (!control) {
      throw new Error(`expected a "${TRIFORGE_VIEW_TITLE}" activity-bar control`);
    }
    return control.openView();
  }

  /** Content part of the (already open) Triforge side bar view. */
  private getContent(): ViewContent {
    return new SideBarView().getContent();
  }

  /** The `Projects` tree view section. */
  async getProjectsSection(): Promise<ViewSection> {
    return this.getContent().getSection(PROJECTS_SECTION_TITLE);
  }

  /** The `Simulations` tree view section. */
  async getSimulationsSection(): Promise<ViewSection> {
    return this.getContent().getSection(SIMULATIONS_SECTION_TITLE);
  }

  /** The `Properties` webview view section. */
  async getPropertiesSection(): Promise<ViewSection> {
    return this.getContent().getSection(PROPERTIES_SECTION_TITLE);
  }
}
