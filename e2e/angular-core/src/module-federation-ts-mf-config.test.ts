import { names } from '@nx/devkit';
import {
  cleanupProject,
  createFile,
  killProcessAndPorts,
  newProject,
  readProjectConfig,
  renameFile,
  runCLI,
  runCommandUntil,
  uniq,
  updateFile,
  updateProjectConfig,
} from '@nrwl/e2e/utils';

describe('Angular Module Federation With TS Mf Config File', () => {
  let proj: string;
  let oldVerboseLoggingValue: string;

  beforeAll(() => {
    proj = newProject();
    oldVerboseLoggingValue = process.env.NX_E2E_VERBOSE_LOGGING;
    process.env.NX_E2E_VERBOSE_LOGGING = 'true';
  });
  afterAll(() => {
    cleanupProject();
    process.env.NX_E2E_VERBOSE_LOGGING = oldVerboseLoggingValue;
  });

  it('should generate valid host and remote apps', async () => {
    const hostApp = uniq('app');
    const remoteApp1 = uniq('remote');
    const sharedLib = uniq('shared-lib');
    const secondaryEntry = uniq('secondary');
    const mfConfigLib = uniq('mf-config-lib');
    const hostPort = 4300;
    const remotePort = 4301;

    // generate host app
    runCLI(
      `generate @nrwl/angular:host ${hostApp} --style=css --no-interactive`
    );
    // generate remote app
    runCLI(
      `generate @nrwl/angular:remote ${remoteApp1} --host=${hostApp} --port=${remotePort} --style=css --no-interactive`
    );

    // check default generated host is built successfully
    const buildOutput = runCLI(`build ${hostApp}`);
    expect(buildOutput).toContain('Successfully ran target build');

    // generate a shared lib with a seconary entry point
    runCLI(
      `generate @nrwl/angular:library ${sharedLib} --buildable --no-interactive`
    );
    runCLI(
      `generate @nrwl/angular:library-secondary-entry-point --library=${sharedLib} --name=${secondaryEntry} --no-interactive`
    );

    // generate a lib with a module federation config ts file
    runCLI(
      `generate @nrwl/js:library ${mfConfigLib} --buildable --no-interactive`
    );

    createFile(
      `libs/${mfConfigLib}/src/lib/mf-config.ts`,
      `import { ModuleFederationConfig } from '@nrwl/devkit';

      const mfeConfig: ModuleFederationConfig = {
        name: '${hostApp}',
        remotes: []
      };

      export default mfeConfig;
      `
    );

    // update host app to use custom mf config ts file and webpack config ts file
    renameFile(
      `apps/${hostApp}/webpack.config.js`,
      `apps/${hostApp}/webpack.config.ts`
    );
    updateFile(
      `apps/${hostApp}/webpack.config.ts`,
      `
      import { withModuleFederation } from '@nrwl/angular/module-federation';
      import mfeConfig from '../../libs/${mfConfigLib}/src/lib/mf-config.ts';
      
      export default withModuleFederation(mfeConfig);
      `
    );

    updateProjectConfig(hostApp, (config) => {
      config.targets.build.options.customWebpackConfig = `apps/${hostApp}/webpack.config.ts`;

      config.targets.serve.options.moduleFederationConfig = `libs/${mfConfigLib}/src/lib/mf-config.ts`;
      return config;
    });

    // update host & remote files to use shared library
    updateFile(
      `apps/${hostApp}/src/app/app.module.ts`,
      `import { NgModule } from '@angular/core';
      import { BrowserModule } from '@angular/platform-browser';
      import { ${
        names(sharedLib).className
      }Module } from '@${proj}/${sharedLib}';
      import { ${
        names(secondaryEntry).className
      }Module } from '@${proj}/${secondaryEntry}';
      import { AppComponent } from './app.component';
      import { NxWelcomeComponent } from './nx-welcome.component';
      import { RouterModule } from '@angular/router';

      @NgModule({
        declarations: [AppComponent, NxWelcomeComponent],
        imports: [
          BrowserModule,
          SharedModule,
          RouterModule.forRoot(
            [
              {
                path: '${remoteApp1}',
                loadChildren: () =>
                  import('${remoteApp1}/Module').then(
                    (m) => m.RemoteEntryModule
                  ),
              },
            ],
            { initialNavigation: 'enabledBlocking' }
          ),
        ],
        providers: [],
        bootstrap: [AppComponent],
      })
      export class AppModule {}
      `
    );
    updateFile(
      `apps/${remoteApp1}/src/app/remote-entry/entry.module.ts`,
      `import { NgModule } from '@angular/core';
    import { CommonModule } from '@angular/common';
    import { RouterModule } from '@angular/router';
    import { ${names(sharedLib).className}Module } from '@${proj}/${sharedLib}';
      import { ${
        names(secondaryEntry).className
      }Module } from '@${proj}/${secondaryEntry}';
    import { RemoteEntryComponent } from './entry.component';

    @NgModule({
      declarations: [RemoteEntryComponent],
      imports: [
        CommonModule,
        SharedModule,
        RouterModule.forChild([
          {
            path: '',
            component: RemoteEntryComponent,
          },
        ]),
      ],
      providers: [],
    })
    export class RemoteEntryModule {}
    `
    );

    const process = await runCommandUntil(
      `serve ${hostApp} --port=${hostPort} --dev-remotes=${remoteApp1}`,
      (output) =>
        output.includes(`listening on localhost:${remotePort}`) &&
        output.includes(`listening on localhost:${hostPort}`)
    );

    // port and process cleanup
    await killProcessAndPorts(process.pid, hostPort, remotePort);
  }, 20_000_000);

  it('should convert apps to MF successfully', async () => {
    const app1 = uniq('app1');
    const app2 = uniq('app2');
    const app1Port = 4400;
    const app2Port = 4401;

    // generate apps
    runCLI(
      `generate @nrwl/angular:application ${app1} --routing --no-interactive`
    );
    runCLI(`generate @nrwl/angular:application ${app2} --no-interactive`);

    // convert apps
    runCLI(
      `generate @nrwl/angular:setup-mf ${app1} --mfType=host --port=${app1Port} --no-interactive`
    );
    runCLI(
      `generate @nrwl/angular:setup-mf ${app2} --mfType=remote --host=${app1} --port=${app2Port} --no-interactive`
    );

    const process = await runCommandUntil(
      `serve ${app1} --dev-remotes=${app2}`,
      (output) =>
        output.includes(`listening on localhost:${app1Port}`) &&
        output.includes(`listening on localhost:${app2Port}`)
    );

    // port and process cleanup
    await killProcessAndPorts(process.pid, app1Port, app2Port);
  }, 20_000_000);

  // TODO(colum): enable when this issue is resolved https://github.com/module-federation/universe/issues/604
  xit('should scaffold MF + SSR setup successfully', async () => {
    const host = uniq('host');
    const remote1 = uniq('remote1');
    const remote2 = uniq('remote2');

    // generate remote apps
    runCLI(
      `generate @nrwl/angular:host ${host} --ssr --remotes=${remote1},${remote2} --no-interactive`
    );

    // ports
    const hostPort = 4500;
    const remote1Port = readProjectConfig(remote1).targets.serve.options.port;
    const remote2Port = readProjectConfig(remote2).targets.serve.options.port;

    const process = await runCommandUntil(
      `serve-ssr ${host} --port=${hostPort}`,
      (output) =>
        output.includes(
          `Node Express server listening on http://localhost:${remote1Port}`
        ) &&
        output.includes(
          `Node Express server listening on http://localhost:${remote2Port}`
        ) &&
        output.includes(
          `Angular Universal Live Development Server is listening`
        )
    );

    // port and process cleanup
    await killProcessAndPorts(process.pid, hostPort, remote1Port, remote2Port);
  }, 20_000_000);
});
