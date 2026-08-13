/** Thrown by services/routes to produce a consistent {error, message} response
 *  via the central error middleware, instead of each route hand-rolling res.status(). */
export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
