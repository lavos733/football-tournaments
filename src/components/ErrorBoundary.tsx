import { Component, type ReactNode } from 'react'

/** Вместо белого экрана при ошибке в интерфейсе — сообщение и кнопка перезагрузки. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="welcome">
        <div className="welcome-logo">⚠️</div>
        <h1>Что-то пошло не так</h1>
        <p className="muted">{this.state.error.message}</p>
        <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
          Перезагрузить
        </button>
      </div>
    )
  }
}
