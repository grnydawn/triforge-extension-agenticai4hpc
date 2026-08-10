import { expect } from 'chai';
import { ActivityBar, VSBrowser } from 'vscode-extension-tester';
import { Sidebar } from '../../pageobjects/Sidebar.ts';

describe('Triforge extension activation (smoke)', function () {
  this.timeout(180000);

  before(async () => {
    await VSBrowser.instance.waitForWorkbench();
  });

  it('contributes the Triforge activity-bar view container', async () => {
    const bar = new ActivityBar();
    const control = await bar.getViewControl('Triforge');
    expect(control, 'expected a "Triforge" activity-bar control').to.not.be.undefined;
  });

  it('opens the Triforge view with the Projects and Simulations sections', async () => {
    const sidebar = new Sidebar();
    await sidebar.openTriforge();

    const projects = await sidebar.getProjectsSection();
    const simulations = await sidebar.getSimulationsSection();

    expect(await projects.getTitle()).to.equal('Projects');
    expect(await projects.isDisplayed(), 'Projects section should be visible').to.be.true;
    expect(await simulations.getTitle()).to.equal('Simulations');
    expect(await simulations.isDisplayed(), 'Simulations section should be visible').to.be.true;
  });
});
