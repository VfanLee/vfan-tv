import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

export class HttpClient {
  private readonly client: AxiosInstance

  constructor() {
    this.client = axios.create({
      timeout: 12_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
    })
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config)
    return response.data
  }
}
