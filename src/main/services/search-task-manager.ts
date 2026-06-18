export class SearchTaskManager {
  private readonly controllers = new Map<string, AbortController>()

  create(searchId: string): AbortSignal {
    const controller = new AbortController()
    this.controllers.set(searchId, controller)
    return controller.signal
  }

  cancel(searchId: string): void {
    this.controllers.get(searchId)?.abort()
    this.controllers.delete(searchId)
  }

  complete(searchId: string): void {
    this.controllers.delete(searchId)
  }
}
