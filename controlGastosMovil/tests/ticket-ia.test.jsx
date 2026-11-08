import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ fetchTicketScanStatus: vi.fn(), scanTicket: vi.fn(), createPending: vi.fn() }))
const img = vi.hoisted(() => ({ prepareTicketImage: vi.fn() }))
const showToast = vi.fn()
vi.mock('../src/context/AppContext', () => ({ useApp: () => ({ showToast }) }))
vi.mock('../src/services/api', async o => ({ ...(await o()), ...api }))
vi.mock('../src/utils/ticketImage', () => img)

import TicketScanScreen from '../src/components/profile/TicketScanScreen'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const foto = () => new File(['x'], 'ticket.jpg', { type: 'image/jpeg' })

describe('TicketScanScreen', () => {
  it('sin IA configurada no ofrece subir nada', async () => {
    api.fetchTicketScanStatus.mockResolvedValue({ disponible: false })
    render(<TicketScanScreen />)
    await screen.findByText(/no está disponible/)
    expect(screen.queryByLabelText('Hacer foto al ticket')).toBeNull()
  })

  it('el aviso de privacidad va ANTES de poder subir la foto', async () => {
    api.fetchTicketScanStatus.mockResolvedValue({ disponible: true })
    render(<TicketScanScreen />)
    await screen.findByText(/se envía a un servicio externo/)
    expect(screen.queryByLabelText('Elegir imagen del ticket')).toBeNull()
    fireEvent.click(screen.getByText('Entiendo, continuar'))
    expect(screen.getByLabelText('Elegir imagen del ticket')).toBeTruthy()
    expect(api.scanTicket).not.toHaveBeenCalled()
  })

  it('flujo: foto → propuesta editable → solo al confirmar se crea el pendiente', async () => {
    api.fetchTicketScanStatus.mockResolvedValue({ disponible: true })
    img.prepareTicketImage.mockResolvedValue('data:image/jpeg;base64,AAAA')
    api.scanTicket.mockResolvedValue({ importe: 23.5, comercio: 'Mercadona', fecha: '2025-03-04' })
    api.createPending.mockResolvedValue({ estado: 'pendiente', id: 1 })
    const onDone = vi.fn()
    render(<TicketScanScreen onDone={onDone} />)
    fireEvent.click(await screen.findByText('Entiendo, continuar'))
    fireEvent.change(screen.getByLabelText('Elegir imagen del ticket'), { target: { files: [foto()] } })
    await screen.findByText('Revisa los datos')
    expect(api.scanTicket).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA')
    expect(api.createPending).not.toHaveBeenCalled()          // nada se guarda sin confirmar
    expect(screen.getByLabelText('Importe').value).toBe('23,5')
    fireEvent.change(screen.getByLabelText('Importe'), { target: { value: '24,00' } })   // el usuario corrige
    fireEvent.click(screen.getByText('Crear pendiente'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.createPending).toHaveBeenCalledWith({ importe: 24, comercio: 'Mercadona', fecha: '2025-03-04', fuente: 'manual' })
  })

  it('si la IA falla, muestra el error y deja reintentar', async () => {
    api.fetchTicketScanStatus.mockResolvedValue({ disponible: true })
    img.prepareTicketImage.mockResolvedValue('data:image/jpeg;base64,AAAA')
    api.scanTicket.mockRejectedValue(new Error('No he podido leer un ticket en la imagen'))
    render(<TicketScanScreen />)
    fireEvent.click(await screen.findByText('Entiendo, continuar'))
    fireEvent.change(screen.getByLabelText('Elegir imagen del ticket'), { target: { files: [foto()] } })
    await screen.findByText('No he podido leer un ticket en la imagen')
    expect(screen.getByLabelText('Elegir imagen del ticket')).toBeTruthy()
    expect(api.createPending).not.toHaveBeenCalled()
  })

  it('importe inválido en la revisión no crea nada', async () => {
    api.fetchTicketScanStatus.mockResolvedValue({ disponible: true })
    img.prepareTicketImage.mockResolvedValue('data:image/jpeg;base64,AAAA')
    api.scanTicket.mockResolvedValue({ importe: null, comercio: null, fecha: null })
    render(<TicketScanScreen />)
    fireEvent.click(await screen.findByText('Entiendo, continuar'))
    fireEvent.change(screen.getByLabelText('Elegir imagen del ticket'), { target: { files: [foto()] } })
    await screen.findByText('Revisa los datos')
    fireEvent.click(screen.getByText('Crear pendiente'))
    await screen.findByText(/Revisa el importe/)
    expect(api.createPending).not.toHaveBeenCalled()
  })
})
