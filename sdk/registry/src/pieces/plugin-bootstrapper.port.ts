export const PLUGIN_BOOTSTRAPPER = 'PLUGIN_BOOTSTRAPPER';

export interface IPluginBootstrapper {
  bootstrap(): Promise<void>;
}
