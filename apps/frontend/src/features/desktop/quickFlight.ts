/** Claim the ID before IPC so even an immediate host result can settle it. */
export class QuickInputFlight {
  private id: string | null = null
  begin(id: string): boolean {
    if (this.id !== null) return false
    this.id = id
    return true
  }
  waiting(id: string): boolean { return this.id === id }
  settle(id: string): boolean {
    if (this.id !== id) return false
    this.id = null
    return true
  }
}
