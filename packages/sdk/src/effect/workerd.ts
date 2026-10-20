export * as KTetherWorkerd from "./workerd"

import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { WorkerdProfile } from "../internal/workerd"
import { KTether } from "./ktether"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions<R = never> extends WorkerdProfile.Options {
  readonly log?: KTether.CreateOptions["log"]
  readonly plugins?: KTether.CreateOptions["plugins"]
  readonly workspaceProviders?: KTether.CreateOptions["workspaceProviders"]
  readonly instances?: KTether.CreateOptions<R>["instances"]
}

export const create = <R = never>({ log, plugins, workspaceProviders, instances, ...options }: CreateOptions<R>) => {
  const profile = WorkerdProfile.make(options)
  return KTether.create(
    { ...profile.options, log, plugins, workspaceProviders, instances },
    { overrides: profile.replacements },
  )
}

export const layer = <R = never>(
  options: CreateOptions<R>,
): Layer.Layer<KTether.Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> =>
  Layer.effect(KTether.Service, create(options))

export type Interface = KTether.Interface
export type Requirements = Scope.Scope
