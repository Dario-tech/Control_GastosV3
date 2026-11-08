import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const showToast = vi.fn()
const refresh = vi.fn()
const importTransactions = vi.hoisted(() => vi.fn())
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))
vi.mock('../src/context/FinanceDataContext', () => ({ useFinanceData: () => ({ refresh }) }))
vi.mock('../src/services/api', async (o) => ({ ...(await o()), importTransactions }))

import CsvImportScreen from '../src/components/ui/CsvImportScreen'

afterEach(() => { cleanup(); vi.clearAllMocks() })

function fichero(texto) {
  return new File([texto], 'extracto.csv', { type: 'text/csv' })
}

describe('CsvImportScreen', () => {
  it('flujo completo: revisar (con duplicado) y confirmar solo las nuevas', async () => {
    importTransactions.mockImplementation(async (filas, confirmar) => confirmar
      ? { importadas: filas.length, duplicadas: 0, errores: 0 }
      : { filas: filas.map((f, i) => ({ i, estado: i === 0 ? 'duplicada' : 'nueva', ...f })) })
    const onClose = vi.fn()
    render(<CsvImportScreen onClose={onClose} />)
    const csv = 'Fecha;Concepto;Importe\n01/03/2025;Mercadona;-45,10\n02/03/2025;Nómina;1.500,00\n'
    const file = fichero(csv)
    file.text = async () => csv
    fireEvent.change(screen.getByLabelText('Elegir fichero CSV'), { target: { files: [file] } })
    await screen.findByText('Vista previa')
    expect(screen.getByText(/2025-03-01 · Mercadona/)).toBeTruthy()

    fireEvent.click(screen.getByText('Revisar antes de guardar'))
    await screen.findByText('Resultado de la revisión')
    expect(importTransactions.mock.calls[0][1]).toBe(false)
    expect(screen.getByText(/ya estaban guardados/)).toBeTruthy()

    fireEvent.click(screen.getByText('Importar 1 movimientos'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const [filasConfirmadas, confirmar] = importTransactions.mock.calls[1]
    expect(confirmar).toBe(true)
    expect(filasConfirmadas).toEqual([{ fecha: '2025-03-02', concepto: 'Nómina', importe: '1.500,00', tipo: 'Ingreso' }])
    expect(refresh).toHaveBeenCalled()
  })

  it('rechaza un fichero vacío sin llamar al servidor', async () => {
    render(<CsvImportScreen onClose={() => {}} />)
    const file = fichero('')
    file.text = async () => ''
    fireEvent.change(screen.getByLabelText('Elegir fichero CSV'), { target: { files: [file] } })
    await screen.findByText('No encuentro filas en el fichero.')
    expect(importTransactions).not.toHaveBeenCalled()
  })
})
