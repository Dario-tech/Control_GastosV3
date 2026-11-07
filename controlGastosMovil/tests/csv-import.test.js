import { describe, it, expect } from 'vitest'
import { parseCsv, detectDelimiter, guessColumns, parseDateCell, splitAmountCell, buildRows } from '../src/utils/csvImport'

describe('csvImport', () => {
  it('detecta el separador y lee comillas', () => {
    const t = '﻿Fecha;Concepto;Importe\r\n01/03/2025;"Bar ""Pepe""; centro";-12,30\r\n'
    expect(detectDelimiter(t)).toBe(';')
    expect(parseCsv(t, ';')).toEqual([['Fecha', 'Concepto', 'Importe'], ['01/03/2025', 'Bar "Pepe"; centro', '-12,30']])
  })
  it('detecta coma y tabulador', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
  })
  it('adivina columnas por cabecera', () => {
    expect(guessColumns(['Fecha operación', 'Descripción', 'Importe (€)', 'Saldo'])).toEqual({ fecha: 0, concepto: 1, importe: 2 })
  })
  it('parsea fechas según el formato y rechaza las imposibles', () => {
    expect(parseDateCell('31/12/2025', 'dmy')).toBe('2025-12-31')
    expect(parseDateCell('1-2-25', 'dmy')).toBe('2025-02-01')
    expect(parseDateCell('2025-12-31 10:00', 'ymd')).toBe('2025-12-31')
    expect(parseDateCell('12/31/2025', 'mdy')).toBe('2025-12-31')
    expect(parseDateCell('31/02/2025', 'dmy')).toBeNull()
    expect(parseDateCell('hola', 'dmy')).toBeNull()
  })
  it('separa el signo del importe', () => {
    expect(splitAmountCell('-1.234,56 €')).toEqual({ negativo: true, texto: '1.234,56 €' })
    expect(splitAmountCell('12,30-')).toEqual({ negativo: true, texto: '12,30' })
    expect(splitAmountCell('(5,00)')).toEqual({ negativo: true, texto: '5,00' })
    expect(splitAmountCell('+1.000,00')).toEqual({ negativo: false, texto: '1.000,00' })
    expect(splitAmountCell('  ')).toBeNull()
  })
  it('construye filas: tipo por signo y omite las malas', () => {
    const m = [['Fecha', 'Concepto', 'Importe'], ['01/03/2025', 'Mercadona', '-45,10'], ['02/03/2025', 'Nómina', '1.500,00'],
      ['xx', 'Mala', '1'], ['03/03/2025', '', '1'], ['04/03/2025', 'Sin importe', '']]
    const mapping = { fecha: 0, concepto: 1, importe: 2 }
    const { filas, omitidas } = buildRows(m, { mapping })
    expect(filas.map(f => [f.fecha, f.tipo, f.importe])).toEqual([
      ['2025-03-01', 'Gasto Variable', '45,10'], ['2025-03-02', 'Ingreso', '1.500,00']])
    expect(omitidas.map(o => o.linea)).toEqual([4, 5, 6])
    expect(buildRows(m, { mapping, signMode: 'gastos' }).filas.every(f => f.tipo === 'Gasto Variable')).toBe(true)
  })
})
