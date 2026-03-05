import { InvalidInputError, PluginAlreadyRegisteredError } from "../errors.js";
import type { ChainId } from "../types.js";
import type { WalletPlugin, WalletPluginDescriptor } from "./types.js";

export class WalletPluginRegistry {
  private readonly pluginsById = new Map<string, WalletPlugin>();

  register(plugin: WalletPlugin): void {
    const pluginId = plugin.id?.trim();
    if (!pluginId) {
      throw new InvalidInputError("Wallet plugin id must be a non-empty string.");
    }

    if (this.pluginsById.has(pluginId)) {
      throw new PluginAlreadyRegisteredError(pluginId);
    }

    this.pluginsById.set(pluginId, plugin);
  }

  getById(pluginId: string): WalletPlugin | undefined {
    return this.pluginsById.get(pluginId);
  }

  getByChain(chain: ChainId): WalletPlugin[] {
    const matches: WalletPlugin[] = [];
    for (const plugin of this.pluginsById.values()) {
      if (plugin.chain === chain) {
        matches.push(plugin);
      }
    }

    return matches;
  }

  list(): WalletPluginDescriptor[] {
    const out: WalletPluginDescriptor[] = [];
    for (const plugin of this.pluginsById.values()) {
      out.push({
        id: plugin.id,
        chain: plugin.chain,
        capabilities: {
          signTransaction: true,
          signMessage: true,
          getPublicKey: true
        }
      });
    }

    return out;
  }
}
