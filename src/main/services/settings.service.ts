import type { AppSettings } from '@shared/types'
import type { SettingsRepository } from '../repositories/settings.repository'

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  get(): AppSettings {
    return this.repository.get()
  }

  update(input: Partial<AppSettings>): AppSettings {
    return this.repository.update(input)
  }
}
